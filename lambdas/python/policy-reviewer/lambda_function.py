import json
import logging
from datetime import datetime
from pathlib import Path

import boto3

import bedrock
from prompts import (
    INITIAL_ANALYSIS_PROMPT,
    POLICY_REVIEW_PROMPT,
    RECOMMENDED_UPDATES_PROMPT,
    UPDATED_POLICY_PROMPT,
)

MAX_TOKENS = 4096

s3_client = boto3.client("s3")
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict, _context) -> dict:
    """Main handler function for the lambda."""
    try:
        content_s3_key = event["content_s3_key"]
        document_key = event["document_key"]
        output_bucket = event["output_bucket"]
        execution_id = event["execution_id"]
        policy_context = event.get(
            "policy_context",
            "Provide a brief description of your policy’s purpose, scope, and any relevant background information. Include details such as the industry or organization it applies to, key stakeholders, and specific goals or concerns. This context will help tailor the review to your needs.",
        )
        legislation_content = event.get("legislation_content", "")

        document_stem = Path(document_key).stem
        policy_content = read_file_from_s3(output_bucket, content_s3_key)

        initial_analysis = get_model_response(
            prompt=INITIAL_ANALYSIS_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_context": policy_context,
            },
        )

        policy_review = get_model_response(
            prompt=POLICY_REVIEW_PROMPT,
            input_data={
                "policy_content": policy_content,
                "initial_analysis": initial_analysis,
                "legislation_content": legislation_content,
            },
        )

        recommended_updates = get_model_response(
            prompt=RECOMMENDED_UPDATES_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_review": policy_review,
            },
        )

        updated_policy = get_model_response(
            prompt=UPDATED_POLICY_PROMPT,
            input_data={
                "policy_content": policy_content,
                "recommended_updates": recommended_updates,
            },
        )

        results = {
            "initial_analysis": initial_analysis,
            "policy_review": policy_review,
            "recommended_updates": recommended_updates,
            "updated_policy": updated_policy,
            "metadata": {
                "document_key": document_key,
                "execution_id": execution_id,
                "timestamp": datetime.now().isoformat(),
            },
        }

        output_key = f"policy_reviews/{execution_id}/review_{document_stem}.json"
        s3_client.put_object(
            Bucket=output_bucket,
            Key=output_key,
            Body=json.dumps(results, indent=2).encode("utf-8"),
            ContentType="application/json",
        )

        return {
            "output_bucket": output_bucket,
            "output_key": output_key,
        }

    except Exception as e:
        logger.error(f"Error in lambda execution: {str(e)}")
        raise


def get_model_response(prompt: str, input_data: dict) -> str:
    """Get response from the model."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(query=formatted_prompt, name_for_logging="policy_review")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            return response.response[0].get("text", "")
    return str(response.response)


def read_file_from_s3(bucket: str, key: str) -> str:
    """Read a file from S3 and return its contents."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read().decode("utf-8")
        return content
    except Exception as e:
        logger.error(f"Error reading from S3: {str(e)}")
        raise
