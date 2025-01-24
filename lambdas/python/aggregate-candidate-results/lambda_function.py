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

        results_prefix = f"candidate_screening_and_matching/{execution_id}/results/"

        screening_results = get_all_screening_results(output_bucket, results_prefix)

        logger.info(f"Found {len(screening_results)} screening results")

        return {
            "screening_results": screening_results,
            "execution_id": execution_id,
            "count": len(screening_results),
        }

    except Exception as e:
        logger.error(f"Error in lambda execution: {str(e)}")
        raise


def get_all_screening_results(bucket: str, prefix: str) -> List[Dict]:
    """Get all screening results from S3 for the given execution."""
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        results = []

        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:

                    response = s3_client.get_object(Bucket=bucket, Key=obj["Key"])
                    content = json.loads(response["Body"].read().decode("utf-8"))
                    results.append(content)

        return results

    except Exception as e:
        logger.error(f"Error reading screening results from S3: {str(e)}")
        raise
