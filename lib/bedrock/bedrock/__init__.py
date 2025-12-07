import base64
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import boto3
import filetype  # type: ignore
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError

from prm import client as prm_client

from .bedrock_model_config import (
    FALLBACK_SEQUENCES,
    ModelInfo,
    ModelTypes,
    Region,
    get_fallback_sequence,
    get_model_id,
    get_model_max_tokens,
    is_quota_limit_error,
)
from .model_providers import NormalizedContent, provider_registry
from .prompts import GET_TEXT_FROM_IMAGE_QUERY

CLAUDE_3_5_SONNET_INPUT_PRICE = 0.003
CLAUDE_3_5_SONNET_OUTPUT_PRICE = 0.015

MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024  # 5MB

logger = structlog.get_logger(__name__)
s3_client = prm_client("s3")


class UnsupportedFiletypeError(Exception):
    pass


class QuotaLimitError(Exception):
    """Raised when all fallback models have been exhausted due to quota limits"""


@dataclass
class GPTResponse:
    response: list
    metadata: dict
    model_used: Optional[str] = None  # Track which model was actually used


class BedrockClaude3Model:
    def __init__(
        self,
        model_type: ModelTypes = ModelTypes.DEFAULT,
        model_args: dict | None = None,
        enable_fallback: bool = True,
        claude_only: bool = False,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        """
        Initialize the Bedrock Claude 3 model with fallback support.

        Args:
            model_type: The primary model type to use
            model_args: Additional model arguments
            enable_fallback: Whether to enable fallback models when quota limits are hit
            claude_only: Whether to only use anthropic models (maintain current behaviour)
            max_retries: Maximum number of retry attempts for non-quota errors
            retry_delay: Delay between retries in seconds
        """
        # Convert external string to enum early at the system boundary
        self.bedrock_region = Region(os.environ["AWS_REGION"])
        self.enable_fallback = enable_fallback
        self.claude_only = claude_only
        self.max_retries = max_retries
        self.retry_delay = retry_delay

        # Initialize Bedrock client
        bedrock_account = os.environ.get("BEDROCK_ACCOUNT")
        if bedrock_account:
            sts = prm_client("sts")
            credentials = sts.assume_role(
                RoleArn=f"arn:aws:iam::{bedrock_account}:role/bedrock-quota-sharing",
                RoleSessionName="bedrock-quota-sharing",
            )["Credentials"]

            self.bedrock_client = prm_client(
                service_name="bedrock-runtime",
                region=self.bedrock_region.value,
                config=Config(read_timeout=1000),
                aws_access_key_id=credentials["AccessKeyId"],
                aws_secret_access_key=credentials["SecretAccessKey"],
                aws_session_token=credentials["SessionToken"],
            )
        else:
            self.bedrock_client = prm_client(
                service_name="bedrock-runtime",
                region=self.bedrock_region.value,
                config=Config(read_timeout=1000),
            )

        # Get fallback sequence (includes primary model as first entry)
        if self.enable_fallback:
            self.fallback_sequence = get_fallback_sequence(
                self.bedrock_region, self.claude_only
            )
        else:
            # If fallback disabled, create sequence with just the primary model
            primary_model_id = get_model_id(self.bedrock_region, model_type)
            self.fallback_sequence = [
                ModelInfo(
                    model_id=primary_model_id,
                    provider="anthropic",
                    name="Primary Model",
                )
            ]

        # Set primary model (first in sequence)
        self.primary_model_id = self.fallback_sequence[0].model_id
        self.current_model_id = self.primary_model_id
        # Track the last successfully used model for get_current_model_info()
        self.last_used_model_id = self.primary_model_id

        self.model_args = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 8000,  # Improved default
        }

        if model_args:
            self.model_args.update(model_args)

    def _get_model_sequence(self) -> List[str]:
        """Get the complete sequence of models to try (primary first, then fallbacks)"""
        return [model_info.model_id for model_info in self.fallback_sequence]

    def _invoke_model_with_fallback(
        self, multimodal_messages: list, name_for_logging: str
    ) -> tuple[dict, str]:
        """
        Invoke model with fallback support.

        Returns:
            tuple: (response, model_id_used)
        """
        if name_for_logging:
            logger.info(f"Invoke model for {name_for_logging}")

        model_sequence = self._get_model_sequence()
        # Collect all errors for better debugging context
        all_errors = []

        for attempt, model_id in enumerate(model_sequence):
            try:
                if attempt == 0:
                    logger.info(
                        "Attempting primary model",
                        model_id=model_id,
                        name_for_logging=name_for_logging,
                    )
                else:
                    logger.info(
                        "Attempting fallback model",
                        model_id=model_id,
                        attempt=attempt,
                        fallback_number=attempt,
                        name_for_logging=name_for_logging,
                    )

                # Get the appropriate provider and build request with model-specific validation
                provider = provider_registry.get_provider(model_id)

                # Create a copy of model_args with max_tokens capped to the model's limit
                model_specific_args = self.model_args.copy()
                requested_max_tokens = model_specific_args.get("max_tokens", 8000)
                model_max_tokens = get_model_max_tokens(model_id)

                # Cap the requested tokens to the model's maximum
                if requested_max_tokens > model_max_tokens:  # type: ignore
                    model_specific_args["max_tokens"] = model_max_tokens
                    if attempt == 0:
                        logger.info(
                            f"Capping max_tokens from {requested_max_tokens} to {model_max_tokens} for model {model_id}",
                            model_id=model_id,
                            requested_max_tokens=requested_max_tokens,
                            model_max_tokens=model_max_tokens,
                        )

                request_body = provider.normalize_request(
                    messages=multimodal_messages, model_args=model_specific_args
                )

                # Attempt to invoke the model
                response = self.bedrock_client.invoke_model(
                    modelId=model_id,
                    body=json.dumps(request_body),
                )

                # If successful, update last used model and log success
                self.last_used_model_id = model_id

                if attempt == 0:
                    logger.info(
                        "Primary model successful",
                        model_id=model_id,
                        name_for_logging=name_for_logging,
                    )
                else:
                    logger.info(
                        "Fallback model successful",
                        model_id=model_id,
                        fallback_number=attempt,
                        name_for_logging=name_for_logging,
                    )

                return response, model_id

            except ClientError as error:
                # Collect this error for context
                all_errors.append(
                    {
                        "model_id": model_id,
                        "attempt": attempt,
                        "error": error,
                        "error_code": error.response.get("Error", {}).get("Code", ""),
                        "error_message": str(error),
                    }
                )

                # Check if this is a quota/throttling error
                if is_quota_limit_error(error):
                    model_type = "primary" if attempt == 0 else f"fallback #{attempt}"
                    logger.warning(
                        f"Quota limit hit for {model_type} model {model_id}",
                        error_code=error.response.get("Error", {}).get("Code", ""),
                        error_message=str(error),
                        model_id=model_id,
                        attempt=attempt,
                        name_for_logging=name_for_logging,
                    )

                    # If this is not the last model in sequence, continue to next
                    if attempt < len(model_sequence) - 1:
                        continue

                    # All models exhausted - raise with full context
                    error_summary = self._build_error_summary(all_errors)
                    logger.error(
                        "All fallback models exhausted for quota limits",
                        total_models_tried=len(model_sequence),
                        name_for_logging=name_for_logging,
                        error_summary=error_summary,
                    )
                    raise QuotaLimitError(
                        f"All {len(model_sequence)} models exhausted due to quota limits. "
                        f"Error summary: {error_summary}"
                    ) from error
                else:
                    # For non-quota errors, implement retry logic with the same model
                    retry_count = 0
                    while retry_count < self.max_retries:
                        try:
                            if retry_count > 0:
                                logger.info(
                                    "Retrying model invocation",
                                    model_id=model_id,
                                    retry_count=retry_count,
                                    name_for_logging=name_for_logging,
                                )
                                time.sleep(self.retry_delay)

                            # Rebuild request body for retry with model-specific validation
                            provider = provider_registry.get_provider(model_id)

                            # Apply the same max_tokens capping logic for retries
                            retry_model_args = self.model_args.copy()
                            requested_max_tokens = retry_model_args.get(
                                "max_tokens", 8000
                            )
                            model_max_tokens = get_model_max_tokens(model_id)

                            if requested_max_tokens > model_max_tokens:  # type: ignore
                                retry_model_args["max_tokens"] = model_max_tokens

                            retry_request_body = provider.normalize_request(
                                messages=multimodal_messages,
                                model_args=retry_model_args,
                            )
                            response = self.bedrock_client.invoke_model(
                                modelId=model_id,
                                body=json.dumps(retry_request_body),
                            )

                            # Success after retry - update last used model
                            self.last_used_model_id = model_id
                            return response, model_id

                        except ClientError as retry_error:
                            if is_quota_limit_error(retry_error):
                                # If quota error during retry, break retry loop and try next model
                                logger.warning(
                                    f"Quota limit hit during retry for model {model_id}",
                                    retry_count=retry_count,
                                    name_for_logging=name_for_logging,
                                )
                                # Update the error in our collection
                                all_errors[-1]["retry_error"] = retry_error
                                break

                            retry_count += 1
                            # Update the error in our collection with retry info
                            all_errors[-1]["retry_count"] = retry_count
                            all_errors[-1]["retry_error"] = retry_error

                            if retry_count >= self.max_retries:
                                logger.error(
                                    f"Max retries exceeded for model {model_id}",
                                    max_retries=self.max_retries,
                                    name_for_logging=name_for_logging,
                                )
                                break

                    # If we've exhausted retries for this model, try the next one if available
                    if attempt < len(model_sequence) - 1:
                        continue

                    # This was the last model and retries failed - raise with full context
                    error_summary = self._build_error_summary(all_errors)
                    logger.error(
                        "Last model failed after retries",
                        model_id=model_id,
                        name_for_logging=name_for_logging,
                        error_summary=error_summary,
                    )
                    raise RuntimeError(
                        f"All models failed. Error summary: {error_summary}"
                    ) from error

        # If we get here, all models and retries failed
        error_summary = self._build_error_summary(all_errors)
        logger.error(
            "All models and retries failed",
            total_models_tried=len(model_sequence),
            name_for_logging=name_for_logging,
            error_summary=error_summary,
        )

        if all_errors:
            last_error = all_errors[-1]["error"]
            if isinstance(last_error, BaseException):
                raise RuntimeError(
                    f"All models failed. Error summary: {error_summary}"
                ) from last_error
            else:
                raise RuntimeError(f"All models failed. Error summary: {error_summary}")

        raise RuntimeError("All models failed but no error was captured")

    def _build_error_summary(self, all_errors: list) -> str:
        """Build a concise summary of all errors encountered during fallback"""
        if not all_errors:
            return "No errors recorded"

        summary_parts = []
        for error_info in all_errors:
            model_id = error_info["model_id"]
            attempt = error_info["attempt"]
            error_code = error_info["error_code"]

            retry_info = ""
            if "retry_count" in error_info:
                retry_info = f" (after {error_info['retry_count']} retries)"

            model_type = "primary" if attempt == 0 else f"fallback #{attempt}"
            summary_parts.append(f"{model_type} ({model_id}): {error_code}{retry_info}")

        return "; ".join(summary_parts)

    def _invoke_model(self, multimodal_messages: list, name_for_logging: str) -> dict:
        """Legacy method for backward compatibility - now uses fallback logic"""
        response, _ = self._invoke_model_with_fallback(
            multimodal_messages, name_for_logging
        )
        return response

    def _process_response(
        self, response: dict, name_for_logging: str, model_used: Optional[str] = None
    ) -> GPTResponse:
        """Process response using provider-specific normalization"""
        result = json.loads(response["body"].read())

        # Log the raw result for debugging model output differences
        logger.info(f"Raw model result for {model_used}: {result}")

        # Get the appropriate provider and extract metadata
        provider = provider_registry.get_provider(model_used or self.current_model_id)
        metadata = provider.extract_usage_metadata(result)

        if name_for_logging:
            log_usage(name_for_logging, metadata, model_used)

        # Normalize content using provider-specific logic
        normalized_content = provider.normalize_response(result)

        # Convert back to legacy format for backward compatibility
        legacy_content = self._convert_to_legacy_format(normalized_content)

        return GPTResponse(legacy_content, metadata, model_used)

    def _convert_to_legacy_format(
        self, normalized_content: List[NormalizedContent]
    ) -> List[Dict[str, Any]]:
        """Convert normalized content back to legacy format for backward compatibility"""
        legacy_format = []

        for content in normalized_content:
            if content.type == "text":
                legacy_format.append(
                    {"type": "text", "text": content.text or ""}
                )  # type: ignore[arg-type]
            elif content.type == "tool_use":
                tool_dict = {
                    "type": "tool_use",
                    "name": content.name,
                    "input": content.input or {},
                }
                if content.id:
                    tool_dict["id"] = content.id
                legacy_format.append(tool_dict)  # type: ignore[arg-type]

        return legacy_format

    def run(
        self,
        query: str,
        name_for_logging: str = "",
    ) -> GPTResponse:
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": query},
                ],
            }
        ]
        response, model_used = self._invoke_model_with_fallback(
            messages, name_for_logging
        )
        return self._process_response(response, name_for_logging, model_used)

    def run_with_messages(
        self,
        messages: list[dict],
        name_for_logging: str = "",
    ) -> GPTResponse:
        """Allows for more customisation of the input messages and roles"""
        response, model_used = self._invoke_model_with_fallback(
            messages, name_for_logging
        )
        return self._process_response(response, name_for_logging, model_used)

    def get_current_model_info(self) -> Optional[ModelInfo]:
        """Get information about the last successfully used model"""
        for model_info in self.fallback_sequence:
            if model_info.model_id == self.last_used_model_id:
                return model_info

        # If last used model is not found in sequence, return None
        return None

    def reset_to_primary_model(self) -> None:
        """Reset to using the primary model (useful for testing or manual resets)"""
        self.current_model_id = self.primary_model_id
        self.last_used_model_id = self.primary_model_id
        logger.info(f"Reset to primary model: {self.primary_model_id}")


def _get_modelinfo_by_id(model_id: str):
    """Return ModelInfo for a given model_id from all fallback sequences, or None if not found."""
    for region_seq in FALLBACK_SEQUENCES.values():
        for model_info in region_seq:
            if model_info.model_id == model_id:
                return model_info
    return None


def __calculate_cost(metadata: dict, model_used: Optional[str] = None) -> tuple:
    """Calculate the cost of using the model, using ModelInfo if available."""
    input_tokens = metadata["input_tokens"]
    output_tokens = metadata["output_tokens"]
    input_price = None
    output_price = None
    if model_used is not None:
        model_info = _get_modelinfo_by_id(model_used)
        if model_info:
            input_price = model_info.input_cost
            output_price = model_info.output_cost
    if input_price is None or output_price is None:
        # Fallback to legacy Claude pricing if not found
        input_price = CLAUDE_3_5_SONNET_INPUT_PRICE / 1000
        output_price = CLAUDE_3_5_SONNET_OUTPUT_PRICE / 1000
    input_cost = (input_tokens / 1000.0) * input_price
    output_cost = (output_tokens / 1000.0) * output_price
    total_cost = input_cost + output_cost
    return input_cost, output_cost, total_cost


def log_usage(name: str, metadata: dict, model_used: Optional[str] = None):
    combined_metadata = {}
    combined_metadata["input_tokens"] = metadata["input_tokens"]
    combined_metadata["output_tokens"] = metadata["output_tokens"]
    combined_metadata["total_tokens"] = (
        metadata["input_tokens"] + metadata["output_tokens"]
    )
    input_cost, output_cost, total_cost = __calculate_cost(metadata, model_used)
    combined_metadata["input_cost"] = input_cost
    combined_metadata["output_cost"] = output_cost
    combined_metadata["total_cost"] = total_cost

    if model_used:
        combined_metadata["model_used"] = model_used

    logger.info(f"Bedrock Usage for {name}:", **combined_metadata)


def get_text_from_image(bucket: str, key: str, enable_fallback: bool = True) -> str:
    s3_file_object = s3_client.get_object(Bucket=bucket, Key=key)
    file_content = s3_file_object["Body"].read()

    content_type = filetype.guess(file_content)
    if content_type:
        media_type = content_type.mime
    else:
        raise UnsupportedFiletypeError("Could not get media type")
    data = base64.b64encode(file_content).decode("utf-8")

    model = BedrockClaude3Model(enable_fallback=enable_fallback, claude_only=True)
    documents = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": data,
            },
        }
    ]
    multimodal_messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": GET_TEXT_FROM_IMAGE_QUERY},
                *documents,
            ],
        }
    ]
    response = model.run_with_messages(multimodal_messages)
    result = response.response[0]["text"]

    return result
