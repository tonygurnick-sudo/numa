import csv
import json
import logging
from io import StringIO
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
        csv_output_key = f"candidate_screening_and_matching/{execution_id}/summary/candidate_rankings.csv"

        screening_results = get_all_screening_results(output_bucket, results_prefix)

        # Logical column ordering
        candidate_summaries = []
        for result in screening_results:
            candidate_data = result["screening_results"]
            summary = {
                "Overall Score": candidate_data["overall_evaluation"]["overall_score"],
                "Full Name": candidate_data["full_name"],
                "Recommendation": candidate_data["overall_evaluation"][
                    "recommendation"
                ],
                "Skills Score": candidate_data["skills_match"]["skills_score"],
                "Experience Score": candidate_data["experience_match"][
                    "experience_score"
                ],
                "Education Score": candidate_data["education_match"]["education_score"],
                "Years of Experience": candidate_data["experience_match"][
                    "years_of_experience"
                ],
                "Relevant Experience Summary": candidate_data["experience_match"][
                    "relevant_experience_summary"
                ],
                "Required Skills Present": ", ".join(
                    candidate_data["skills_match"]["required_skills_present"]
                ),
                "Required Skills Missing": ", ".join(
                    candidate_data["skills_match"]["required_skills_missing"]
                ),
                "Additional Relevant Skills": ", ".join(
                    candidate_data["skills_match"]["additional_relevant_skills"]
                ),
                "Education Requirements Met": candidate_data["education_match"][
                    "education_requirements_met"
                ],
                "Education Details": candidate_data["education_match"][
                    "education_details"
                ],
                "Key Strengths": ", ".join(
                    candidate_data["overall_evaluation"]["strengths"]
                ),
                "Areas for Improvement": ", ".join(
                    candidate_data["overall_evaluation"]["gaps"]
                ),
                "Detailed Feedback": candidate_data["overall_evaluation"][
                    "detailed_feedback"
                ],
                "Resume File": result["resume_key"],
                "Cover Letter File": result["cover_letter_key"] or "Not Provided",
            }
            candidate_summaries.append(summary)

        # Overall score in descending order
        candidate_summaries.sort(key=lambda x: x["Overall Score"], reverse=True)

        csv_buffer = StringIO()
        if candidate_summaries:
            writer = csv.DictWriter(
                csv_buffer, fieldnames=candidate_summaries[0].keys()
            )
            writer.writeheader()
            writer.writerows(candidate_summaries)

        s3_client.put_object(
            Bucket=output_bucket,
            Key=csv_output_key,
            Body=csv_buffer.getvalue(),
            ContentType="text/csv",
        )

        return {
            "csv_location": {"bucket": output_bucket, "key": csv_output_key},
            "candidates_processed": len(candidate_summaries),
            "execution_id": execution_id,
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
