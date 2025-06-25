import os

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import claude_prompts
import claude_tools
import helpers

logger = structlog.get_logger()

s3_client = boto3.client("s3")


def __key(app_id: str, user_id: str, job_id: str, name: str, area: str = "") -> str:
    key = f"{app_id}/{user_id}/{job_id}/{name}"
    if area:
        key += f"_{area}"
    return key


def __read_string_from_s3(key) -> str:
    bucket = os.environ.get("BUCKET")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read().decode("utf-8")


def __write_string_to_s3(string: str, key: str):
    bucket = os.environ.get("BUCKET")
    s3_client.put_object(Body=string.encode("utf-8"), Bucket=bucket, Key=key)


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

    additional_comments = event["additional_comments"]
    area = event["data_single_area"]["policy_area"]
    custom_additional_instructions = event["custom_additional_instructions"]
    data_single_area = event["data_single_area"]
    default_additional_instructions = event["default_additional_instructions"]
    domain_area = event["domain_area"]
    domain_area = event["domain_area"]
    organisation_context = event["organisation_context"]
    organisation_name = event["organisation_name"]
    policy_principles = event["policy_principles"]
    policy_structure_overview = event["policy_structure_overview"]

    board_assurance_statement = __read_string_from_s3(
        event["input_files"]["board_assurance_statement"]
    )
    board_assurance_statement_guidelines = __read_string_from_s3(
        event["input_files"]["board_assurance_statement_guidelines"]
    )

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": claude_tools.LEGAL_REVIEW_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_policy_review"},
            "max_tokens": 8000,
        },
    )
    expert_review = __read_string_from_s3(data_single_area["expert_review_key"])

    legal_review_result = model.run(
        claude_prompts.LEGAL_REVIEW_PROMPT.format(
            additional_comments=additional_comments,
            board_assurance_statement=board_assurance_statement,
            custom_additional_instructions=custom_additional_instructions,
            default_additional_instructions=default_additional_instructions,
            domain_area=domain_area,
            guidelines_for_board_assurance_statement=board_assurance_statement_guidelines,
            policy_area_name=area,
            policy_area_name_policy=expert_review,
            policy_principles=policy_principles,
            policy_structure_overview=policy_structure_overview,
            school_context=organisation_context,
            school_name=organisation_name,
        ),
        f"legal review for {area}",
    )

    output = legal_review_result.response[0]["input"]
    legal_review = output["legal_policy_review"]
    legal_references = output["legal_references"]

    app_id = event["app_id"]
    job_id = event["job_id"]
    user_id = event.get("user_id", "unknown")

    legal_review_feedback_key = __key(
        app_id, user_id, job_id, "legal_review_feedback", area
    )
    __write_string_to_s3(legal_review, legal_review_feedback_key)

    board_assurance_statement = __read_string_from_s3(
        event["input_files"]["board_assurance_statement"]
    )

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": claude_tools.IMPLEMENT_LEGAL_REVIEW_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_policy_review"},
            "max_tokens": 8000,
        },
    )

    implement_legal_review_result = model.run(
        claude_prompts.IMPLEMENT_LEGAL_REVIEW_PROMPT.format(
            board_assurance_statement=board_assurance_statement,
            domain_area=domain_area,
            policy_area_name=area,
            policy_area_name_legal_references=legal_references,
            policy_area_name_legal_review=legal_review,
            policy_area_name_policy=expert_review,
            school_name=organisation_name,
        ),
        f"legal review implementation for {area}",
    )

    policy = implement_legal_review_result.response[0]["input"]["policy"]
    explanation = implement_legal_review_result.response[0]["input"]["explanation"]

    legal_review_implementation_key = __key(
        app_id,
        user_id,
        job_id,
        "legal_review_implementation",
        area,
    )
    __write_string_to_s3(policy, legal_review_implementation_key)

    legal_review_implementation_explanation_key = __key(
        app_id,
        user_id,
        job_id,
        "legal_review_implementation_explanation",
        area,
    )
    __write_string_to_s3(explanation, legal_review_implementation_explanation_key)
    return {
        "legal_review_feedback_key": legal_review_feedback_key,
        "legal_review_implementation_explanation_key": legal_review_implementation_explanation_key,
        "legal_review_implementation_key": legal_review_implementation_key,
    }
