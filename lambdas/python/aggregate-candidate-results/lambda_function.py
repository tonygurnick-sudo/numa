import csv
import json
import os
from io import StringIO

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    """
    Lambda function to aggregate candidate screening results and generate a CSV summary.
    """
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        app_id = event["app_id"]
        job_id = event["job_id"]
        user_id = event["user_id"]

        logger.info(
            "Aggregating candidate results",
            app_id=app_id,
            job_id=job_id,
            user_id=user_id,
        )

        # Use the secure path format with user_id
        results_prefix = f"{app_id}/{user_id}/{job_id}/results/"
        csv_output_key = f"{app_id}/{user_id}/{job_id}/summary/candidate_rankings.csv"

        screening_results = get_all_screening_results(results_prefix)

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

        candidate_summaries.sort(key=lambda x: x["Overall Score"], reverse=True)

        csv_buffer = StringIO()
        if candidate_summaries:
            writer = csv.DictWriter(
                csv_buffer, fieldnames=candidate_summaries[0].keys()
            )
            writer.writeheader()
            writer.writerows(candidate_summaries)

        s3_helpers.write(
            csv_output_key,
            csv_buffer.getvalue().encode("utf-8"),
            content_type="text/csv",
        )

        logger.info("Wrote candidate rankings CSV to secure path", key=csv_output_key)

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/csv",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": csv_output_key,
                            },
                            "location": "S3",
                            "title": "Candidate Rankings",
                        }
                    ],
                }
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def get_all_screening_results(prefix: str) -> list[dict]:
    try:
        results = []
        keys = s3_helpers.list_objects(prefix)

        for key in keys:
            content = json.loads(s3_helpers.read(key).decode("utf-8"))
            results.append(content)

        logger.info("Found screening results", count=len(results), prefix=prefix)
        return results

    except Exception:
        logger.exception("Error reading screening results from S3", prefix=prefix)
        raise
