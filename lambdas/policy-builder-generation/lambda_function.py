import os
import uuid

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import claude_prompts
import claude_tools
import helpers

logger = structlog.get_logger()

s3_client = boto3.client("s3")


def __get_job_id(event: dict):
    return event.get("job_id", str(uuid.uuid4()))


def __key(app_name: str, job_id: str, name: str, area: str = "") -> str:
    key = f"{app_name}/{job_id}/{name}"
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
    app_name = event["app_name"]
    job_id = __get_job_id(event)
    helpers.setup_logging()
    structlog.contextvars.bind_contextvars(
        function_name=context.function_name,
        app_name=app_name,
        job_id=job_id,
    )
    logger.info("Execute lambda", lambda_event=event)

    additional_comments = event["additional_comments"]
    area = event["data_single_area"]["policy_area"]
    custom_additional_instructions = event["custom_additional_instructions"]
    default_additional_instructions = event["default_additional_instructions"]
    domain_area = event["domain_area"]
    policy_principles = event["policy_principles"]
    policy_structure_list = event["policy_structure_list"]
    policy_structure_overview = event["policy_structure_overview"]

    exemplar_policy = __read_string_from_s3(event["input_files"]["exemplar_policy"])

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": claude_tools.INITIAL_POLICY_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_policy"},
            "max_tokens": 8000,
        },
    )
    initial_policy_result = model.run(
        claude_prompts.INITIAL_POLICY_PROMPT.format(
            additional_comments=additional_comments,
            categories_and_descriptions=policy_structure_list,
            custom_additional_instructions=custom_additional_instructions,
            default_additional_instructions=default_additional_instructions,
            domain_area=domain_area,
            exemplar_set_of_policies=exemplar_policy,
            policy_area_name=area,
            policy_principles=policy_principles,
            policy_structure_overview=policy_structure_overview,
            school_context=event["organisation_context"],
            school_name=event["organisation_name"],
        ),
        f"initial policy generation for {area}",
    )

    output = initial_policy_result.response[0]["input"]

    initial_policy_key = __key(app_name, job_id, "initial_policy", area)
    __write_string_to_s3(output["policy"], initial_policy_key)

    initial_policy_explanation_key = __key(
        app_name,
        job_id,
        "initial_policy_explanation",
        area,
    )
    __write_string_to_s3(output["explanation"], initial_policy_explanation_key)
    return {
        "initial_policy_key": initial_policy_key,
        "initial_policy_explanation_key": initial_policy_explanation_key,
    }
