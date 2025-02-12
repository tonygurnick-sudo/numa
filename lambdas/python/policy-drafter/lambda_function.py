import json
from datetime import datetime

import boto3
import structlog
from botocore.exceptions import ClientError

import bedrock
from prompts import (
    DRAFT_POLICY_PROMPT,
    LEGISLATIVE_REVIEW_PROMPT,
    TEMPLATE_GENERATION_PROMPT,
)
from tools import POLICY_GENERATION_TOOL

MAX_TOKENS = 4096

logger = structlog.get_logger(__name__)
s3_client = boto3.client("s3")


class PolicyGenerationError(Exception):
    pass


def remove_backticks(text: str) -> str:
    """Remove all backticks from a string."""
    return text.replace("`", "")


def get_model_response(prompt: str, input_data: dict) -> str:
    """Get response from the model."""
    try:
        model = bedrock.BedrockClaude3Model(
            model_args={
                "max_tokens": MAX_TOKENS,
                "temperature": 0.1,
                "tools": POLICY_GENERATION_TOOL,
                "tool_choice": {"type": "tool", "name": "policy_content"},
            }
        )

        formatted_prompt = prompt.format(**input_data)
        response = model.run(query=formatted_prompt, name_for_logging="policy_drafter")

        if isinstance(response.response, list) and response.response:
            if isinstance(response.response[0], dict):
                content = response.response[0]["input"]["content"]
                return remove_backticks(content)
        return ""
    except Exception as e:
        logger.exception("Failed to get model response")
        raise PolicyGenerationError("Failed to get model response") from e


def read_file_from_s3(bucket: str, key: str) -> str:
    """Read a file from S3 and return its contents."""
    try:
        logger.info("Reading file from S3", bucket=bucket, key=key)
        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read().decode("utf-8")
    except ClientError as e:
        logger.exception("Failed to read from S3", bucket=bucket, key=key)
        raise PolicyGenerationError(f"Failed to read from S3: {bucket}/{key}") from e


def write_to_s3(bucket: str, key: str, content: dict) -> None:
    """Write content to S3."""
    try:
        logger.info("Writing to S3", bucket=bucket, key=key)
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(content, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    except ClientError as e:
        logger.exception("Failed to write to S3", bucket=bucket, key=key)
        raise PolicyGenerationError(f"Failed to write to S3: {bucket}/{key}") from e


def handler(event: dict, _context) -> dict:
    """Main handler function for the lambda."""
    try:
        policy_area = event["policy_area"]
        additional_instructions = event["additional_instructions"]
        output_bucket = event["output_bucket"]
        execution_id = event["execution_id"]

        logger.info(
            "Starting policy generation",
            policy_area=policy_area,
            execution_id=execution_id,
        )

        example_template_content = ""
        if "example_template_s3_key" in event:
            example_template_content = read_file_from_s3(
                output_bucket, event["example_template_s3_key"]
            )

        legislation_content = ""
        if "legislation_s3_key" in event:
            legislation_content = read_file_from_s3(
                output_bucket, event["legislation_s3_key"]
            )

        template = get_model_response(
            prompt=TEMPLATE_GENERATION_PROMPT,
            input_data={
                "policy_area": policy_area,
                "additional_instructions": additional_instructions,
            },
        )

        draft_policy = get_model_response(
            prompt=DRAFT_POLICY_PROMPT,
            input_data={
                "policy_area": policy_area,
                "additional_instructions": additional_instructions,
                "example_template": example_template_content,
                "generated_template": template,
            },
        )

        legislative_review = ""
        if legislation_content:
            legislative_review = get_model_response(
                prompt=LEGISLATIVE_REVIEW_PROMPT,
                input_data={
                    "policy_area": policy_area,
                    "draft_policy": draft_policy,
                    "legislation_content": legislation_content,
                },
            )

        results = {
            "template": template,
            "draft_policy": draft_policy,
            "legislative_review": legislative_review,
            "metadata": {
                "policy_area": policy_area,
                "execution_id": execution_id,
                "timestamp": datetime.now().isoformat(),
            },
        }

        output_key = f"policy_drafts/{execution_id}/draft_{policy_area}.json"
        write_to_s3(output_bucket, output_key, results)

        logger.info(
            "Policy generation completed",
            policy_area=policy_area,
            execution_id=execution_id,
            output_key=output_key,
        )

        return {
            "output_bucket": output_bucket,
            "output_key": output_key,
        }

    except Exception as e:
        logger.exception("Policy generation failed")
        raise PolicyGenerationError("Policy generation failed") from e
