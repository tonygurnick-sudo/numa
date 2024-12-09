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


def __read_string_from_s3(key) -> str:
    bucket = os.environ.get("BUCKET")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read().decode("utf-8")


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

    domain_area = event["domain_area"]

    exemplar_policy = __read_string_from_s3(event["input_files"]["exemplar_policy"])

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": claude_tools.PRINCIPLES_AND_STRUCTURES_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_principals_and_structure"},
            "max_tokens": 8000,
        },
    )

    result = model.run(
        claude_prompts.PRINCIPLES_AND_STRUCTURES_PROMPT.format(
            domain_area=domain_area,
            exemplar_set_of_policies=exemplar_policy,
        ),
        "creating policy principles and structure",
    )

    output = result.response[0]["input"]
    return {
        "policy_principles": output["policy_principles"],
        "policy_structure_list": output["policy_structure_list"],
        "policy_structure_overview": output["policy_structure_overview"],
    }
