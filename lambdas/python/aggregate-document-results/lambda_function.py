import json
import logging
from typing import Dict, List

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")


def handler(event: dict, _context) -> dict:
    """Main handler function for the lambda."""
    try:
        output_bucket = event["output_bucket"]
        execution_id = event["execution_id"]

        summaries_prefix = f"document_processing/{execution_id}/summaries/"
        aggregated_output_key = f"document_processing/{execution_id}/final/result.txt"

        summary_results = get_all_summary_results(output_bucket, summaries_prefix)

        formatted_content = format_summaries(summary_results)

        save_results_to_s3(output_bucket, aggregated_output_key, formatted_content)

        return {
            "results_location": aggregated_output_key,
            "documents_processed": len(summary_results),
            "execution_id": execution_id,
        }

    except Exception as e:
        logger.error(f"Error in lambda execution: {str(e)}")
        raise


def format_summaries(summary_results: List[Dict]) -> str:
    """Format all summaries into a single text document."""
    sorted_results = sorted(summary_results, key=lambda x: x["document_key"])

    formatted_parts = []

    formatted_parts.append("# Document Summaries\n")

    for i, result in enumerate(sorted_results, 1):
        doc_name = result["document_key"].split("/")[-1]

        formatted_parts.extend(
            [
                f"\n## Document {i}: {doc_name}\n",
                f"{result['summary_results']['markdown_summary']}\n",
            ]
        )

    return "\n".join(formatted_parts)


def get_all_summary_results(bucket: str, prefix: str) -> List[Dict]:
    """Get all summary results from S3 for the given execution."""
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        results = []

        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:
                    logger.info(f"Reading file: {obj['Key']}")
                    response = s3_client.get_object(Bucket=bucket, Key=obj["Key"])
                    content = json.loads(response["Body"].read().decode("utf-8"))
                    results.append(content)

        return results

    except Exception as e:
        logger.error(f"Error reading summary results from S3: {str(e)}")
        raise


def save_results_to_s3(bucket: str, key: str, content: str) -> None:
    """Save results to S3."""
    try:
        s3_client.put_object(
            Bucket=bucket, Key=key, Body=content, ContentType="text/plain"
        )
    except Exception as e:
        logger.error(f"Error writing to S3: {str(e)}")
        raise
