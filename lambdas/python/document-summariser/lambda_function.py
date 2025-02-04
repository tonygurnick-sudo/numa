import json
import logging
import uuid
from pathlib import Path

import boto3

import bedrock
from prompts import DOCUMENT_SUMMARY_PROMPT
from tools import DOCUMENT_SUMMARY_TOOL

MAX_TOKENS = 4096

s3_client = boto3.client("s3")
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def generate_unique_code():
    """Generate a short unique code."""
    return str(uuid.uuid4())[:8]


def handler(event: dict, _context) -> dict:
    """Main handler function for the lambda."""
    try:
        content_s3_key = event["content_s3_key"]
        document_key = event["document_key"]
        output_bucket = event["output_bucket"]
        execution_id = event["execution_id"]

        document_stem = Path(document_key).stem
        unique_code = generate_unique_code()

        output_key = f"document_processing/{execution_id}/summaries/{document_stem}_{unique_code}.json"
        logger.info(f"Generated output key: {output_key}")

        document_content = read_file_from_s3(output_bucket, content_s3_key)

        input_data = {
            "document_content": document_content,
            "focus_area": "General summary",
            "summary_level": "detailed",
        }

        model = bedrock.BedrockClaude3Model(
            model_args={
                "max_tokens": MAX_TOKENS,
                "temperature": 0.1,
                "tools": DOCUMENT_SUMMARY_TOOL,
                "tool_choice": {"type": "tool", "name": "summarize_document"},
            }
        )

        summary_results = get_summary_result(
            model=model, prompt=DOCUMENT_SUMMARY_PROMPT, input_data=input_data
        )

        final_results = {
            "summary_results": summary_results,
            "document_key": document_key,
            "execution_id": execution_id,
            "unique_code": unique_code,
            "output_path": output_key,
        }

        save_results_to_s3(output_bucket, output_key, final_results)

        return final_results

    except Exception as e:
        logger.error(f"Error in lambda execution: {str(e)}")
        raise


def read_file_from_s3(bucket: str, key: str) -> str:
    """Read a file from S3 and return its contents."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read().decode("utf-8")
        return content
    except Exception as e:
        logger.error(f"Error reading from S3: {str(e)}")
        raise


def save_results_to_s3(bucket: str, key: str, results: dict) -> None:
    """Save results to S3."""
    try:
        logger.info(f"Saving to S3: bucket={bucket}, key={key}")
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(results, indent=2),
            ContentType="application/json",
        )
        logger.info("Successfully saved to S3")
    except Exception as e:
        logger.error(f"Error writing to S3: {str(e)}")
        raise


def get_summary_result(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    input_data: dict,
) -> dict:
    """Get summary results from the model."""
    formatted_prompt = prompt.format(
        document_content=input_data["document_content"],
        focus_area=input_data["focus_area"],
        summary_level=input_data["summary_level"],
    )

    response = model.run(
        query=formatted_prompt, name_for_logging="document_summarization"
    )

    try:
        result = response.response[0]["input"]
        return {**result, "metadata": response.metadata}
    except Exception as e:
        logger.error(f"Error processing model response: {str(e)}")
        logger.error(f"Raw response: {response}")
        raise
