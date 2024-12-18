import os
import typing
import uuid

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import claude_prompts
import claude_tools
import helpers
import markdown_to_pdf

logger = structlog.get_logger()

s3_client = boto3.client("s3")

SEPARATOR = "--------------------------------\n"


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


def __write_file_object_to_s3(fileobj: typing.BinaryIO, file_name: str):
    bucket = os.environ.get("BUCKET")
    fileobj.seek(0)
    s3_client.upload_fileobj(fileobj, bucket, file_name)


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
    custom_additional_instructions = event["custom_additional_instructions"]
    data_all_areas = {
        area["policy_area"]: data
        for area, data in zip(event["policy_structure_list"], event["data_all_areas"])
    }
    default_additional_instructions = event["default_additional_instructions"]
    domain_area = event["domain_area"]
    organisation_context = event["organisation_context"]
    organisation_name = event["organisation_name"]
    policy_principles = event["policy_principles"]
    policy_structure_list = event["policy_structure_list"]
    policy_structure_overview = event["policy_structure_overview"]

    exemplar_policy = __read_string_from_s3(event["input_files"]["exemplar_policy"])

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": claude_tools.INTRODUCTION_CONCLUSION_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_policy"},
            "max_tokens": 8000,
        },
    )
    policies = ""
    policies_for_prompt = SEPARATOR
    for area in policy_structure_list:
        policy_area = area["policy_area"]

        key_value = data_all_areas[policy_area]["legal_review_implementation_key"]
        content = __read_string_from_s3(key_value)
        policies += f"{content}\n\n"
        policies_for_prompt += f"{policy_area}: {content}\n" + SEPARATOR

    document_result = model.run(
        claude_prompts.INTRODUCTION_CONCLUSION_PROMPT.format(
            additional_comments=additional_comments,
            custom_additional_instructions=custom_additional_instructions,
            default_additional_instructions=default_additional_instructions,
            domain_area=domain_area,
            exemplar_set_of_policies=exemplar_policy,
            policies=policies_for_prompt,
            policy_principles=policy_principles,
            policy_structure_overview=policy_structure_overview,
            school_context=organisation_context,
            school_name=organisation_name,
        ),
        "building other document parts",
    )

    output = document_result.response[0]["input"]

    logger.info("Building final policy.")
    final_policy = "\n\n".join(
        [
            output["title"],
            output["introduction"],
            output["definitions"],
            output["table_of_contents"],
            policies,
            output["conclusion"],
        ]
    )

    final_policy_markdown_key = __key(app_name, job_id, "final_policy.md")
    __write_string_to_s3(final_policy, final_policy_markdown_key)

    final_policy_html = markdown_to_pdf.markdown_to_html(final_policy)
    final_policy_html_key = __key(app_name, job_id, "final_policy.html")
    __write_string_to_s3(final_policy_html, final_policy_html_key)

    final_policy_pdf = markdown_to_pdf.html_to_pdf(final_policy_html)
    final_policy_pdf_key = __key(app_name, job_id, "final_policy.pdf")
    __write_file_object_to_s3(final_policy_pdf, final_policy_pdf_key)

    return {
        "final_policy_pdf_key": final_policy_pdf_key,
    }
