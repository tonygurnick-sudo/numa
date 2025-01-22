import json
import logging
from typing import Optional

import boto3

import bedrock
from prompts import CANDIDATE_SCREENING_PROMPT
from tools import CANDIDATE_SCREENING_TOOL

MAX_TOKENS = 4096

s3_client = boto3.client("s3")
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict, _context) -> dict:
    """Main handler function for the lambda."""
    try:
        resume_key = event["resume_text_s3_key"]
        cover_letter_key = event["cover_letter_text_s3_key"]
        company_profile = event["company_profile"]
        job_requirements = event["job_requirements"]
        output_bucket = event["output_bucket"]
        output_key = event["output_key"]

        resume_text = read_file_from_s3(output_bucket, resume_key)

        cover_letter_text = None
        if cover_letter_key:
            cover_letter_text = read_file_from_s3(output_bucket, cover_letter_key)

        input_data = {
            "resume_text": resume_text,
            "cover_letter_text": cover_letter_text,
            "company_profile": company_profile,
            "job_requirements": job_requirements,
        }

        model = bedrock.BedrockClaude3Model(
            model_args={
                "max_tokens": MAX_TOKENS,
                "temperature": 0.1,
                "tools": CANDIDATE_SCREENING_TOOL,
                "tool_choice": {"type": "tool", "name": "analyze_candidate"},
            }
        )

        screening_results = get_screening_result(
            model=model, prompt=CANDIDATE_SCREENING_PROMPT, input_data=input_data
        )

        final_results = {
            "screening_results": screening_results,
            "resume_key": resume_key,
            "cover_letter_key": cover_letter_key,
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
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(results),
            ContentType="application/json",
        )
    except Exception as e:
        logger.error(f"Error writing to S3: {str(e)}")
        raise


def get_screening_result(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    input_data: dict,
) -> dict:
    """Get screening results from the model."""
    formatted_prompt = prompt.format(
        company_profile=json.dumps(input_data["company_profile"]),
        job_requirements=json.dumps(input_data["job_requirements"]),
        resume_text=input_data["resume_text"],
        cover_letter_text=(
            input_data["cover_letter_text"]
            if input_data["cover_letter_text"]
            else "No cover letter provided"
        ),
    )

    response = model.run(query=formatted_prompt, name_for_logging="candidate_screening")

    try:
        result = response.response[0]["input"]
        return {**result, "metadata": response.metadata}
    except Exception as e:
        logger.error(f"Error processing model response: {str(e)}")
        logger.error(f"Raw response: {response.response}")
        raise
