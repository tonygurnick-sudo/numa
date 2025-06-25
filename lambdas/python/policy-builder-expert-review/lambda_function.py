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
    custom_additional_instructions = event["custom_additional_instructions"]
    area = event["data_single_area"]["policy_area"]
    data_single_area = event["data_single_area"]
    default_additional_instructions = event["default_additional_instructions"]
    domain_area = event["domain_area"]
    organisation_context = event["organisation_context"]
    organisation_name = event["organisation_name"]
    policy_principles = event["policy_principles"]
    policy_structure_overview = event["policy_structure_overview"]

    exemplar_policy = __read_string_from_s3(event["input_files"]["exemplar_policy"])

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": claude_tools.REVIEW_POLICY_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_policy_review"},
            "max_tokens": 8000,
        },
    )
    area_policy = __read_string_from_s3(data_single_area["initial_policy_key"])
    area_explanation = __read_string_from_s3(
        data_single_area["initial_policy_explanation_key"]
    )

    review_policy_result = model.run(
        claude_prompts.REVIEW_POLICY_PROMPT.format(
            additional_comments=additional_comments,
            custom_additional_instructions=custom_additional_instructions,
            default_additional_instructions=default_additional_instructions,
            domain_area=domain_area,
            exemplar_set_of_policies=exemplar_policy,
            policy_area_name=area,
            policy_area_name_explanation=area_explanation,
            policy_area_name_policy=area_policy,
            policy_principles=policy_principles,
            policy_structure_overview=policy_structure_overview,
            school_context=organisation_context,
            school_name=organisation_name,
        ),
        f"expert review for {area}",
    )

    output = review_policy_result.response[0]["input"]

    app_id = event["app_id"]
    job_id = event["job_id"]
    user_id = event.get("user_id", "unknown")

    expert_review_key = __key(app_id, user_id, job_id, "expert_review", area)
    __write_string_to_s3(output["policy"], expert_review_key)

    expert_review_explanation_key = __key(
        app_id,
        user_id,
        job_id,
        "expert_review_explanation",
        area,
    )
    __write_string_to_s3(output["explanation"], expert_review_explanation_key)

    return {
        "expert_review_key": expert_review_key,
        "expert_review_explanation_key": expert_review_explanation_key,
    }
